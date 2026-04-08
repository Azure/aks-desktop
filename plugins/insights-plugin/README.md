# Insights (Preview)

The **Insights** feature brings real-time observability to AKS Desktop via the insights-plugin powered by eBPF. It allows you to gain deep visibility into your AKS clusters directly from the desktop UI—no kubectl required.

> **Note:** This feature is currently in **Preview**.

---

## Overview

The Insights plugin is built on the open source project [Inspektor Gadget](https://github.com/inspektor-gadget/inspektor-gadget) and [IG Desktop](https://github.com/inspektor-gadget/ig-desktop). It uses **eBPF** to collect granular, low-overhead data from the Linux kernel across all nodes and workloads in your cluster. This kernel level data is automatically mapped to pods, nodes, namespaces so that you can get context aware, actionable insights. 

Once enabled, an **Insights** tab appears in the project view, giving you a centralized place to explore observability data for your cluster.

---

## Prerequisites

Before enabling Insights, ensure your cluster meets the following requirements:

- An active AKS cluster connected to AKS Desktop.
- Sufficient permissions to deploy workloads to the cluster (Inspektor Gadget is deployed as a DaemonSet).
- The cluster nodes must be running a Linux kernel that supports eBPF (kernel ≥ 5.4 recommended).

---

## Enabling Insights

Follow these steps to enable the Insights feature in AKS Desktop:

### Step 1: Open AKS Desktop

Launch the AKS Desktop application and ensure you are signed in and connected to your AKS cluster.

### Step 2: Enable the Insights Plugin

1. In the left-hand navigation, click **Settings**.
2. From the Settings submenu, select **Plugins**.
3. Locate the **Insights** plugin in the list and click the **Enable** toggle to turn it on.

### Step 3: Navigate to Your Project

In the left-hand navigation, select the **Project** you want to use Insights with. The **Insights** tab will now be visible in the project view.

### Step 4: Deploy Inspektor Gadget to the Cluster

On the Insights tab, you will be prompted to deploy **Inspektor Gadget** to your cluster if it is not already installed.

1. Click **Deploy Inspektor Gadget**.
2. AKS Desktop will deploy the Inspektor Gadget DaemonSet to your cluster. 
3. Wait for the deployment to complete. A status indicator will confirm when Inspektor Gadget is ready.

### Step 5: Start Exploring Insights

Once Inspektor Gadget is deployed, the Insights tab will populate with live observability data from your cluster. You can now use the full set of Insights capabilities described below.

---

## What you can do with Insights

### Performance troubleshooting with Processes

Identify the root cause of performance issues such as:
- High CPU or memory consumption by specific pods
- Abnormal Block I/O activity

### Network visibility with Trace TCP

Monitor network traffic at the kernel level:
- See which pods are making outbound connections and to where
- Detect unexpected or unauthorized network activity
- Understand network anomalies and troubleshoot with broad network visibility

### Solve DNS issues with Trace DNS

- See which DNS queries are failing to resolve
- Identify DNS latency
- Check the health of CoreDNS and Upstream DNS


---

## Uninstalling Inspektor Gadget

If you wish to remove Inspektor Gadget from your cluster you can uninstall it manually via `kubectl`:

```bash
kubectl delete ns gadget
```

> **Note:** This will remove ALL resources in the namespace, not just those created by Inspektor Gadget.
---

## Troubleshooting

| Issue | Resolution |
|---|---|
| **Insights tab is not visible** | Ensure the Insights plugin is enabled. Go to **Settings** > **Plugins** and toggle **Insights** on. |
| **Deployment of Inspektor Gadget fails** | Verify you have sufficient RBAC permissions to create DaemonSets and ClusterRoles in the cluster. |
| **No data appears after deployment** | Confirm the cluster nodes are running a supported Linux kernel (≥ 5.4). Check the Inspektor Gadget pod logs for errors. |

---

## Additional Resources

- [Inspektor Gadget GitHub](https://github.com/inspektor-gadget/inspektor-gadget)
- [Insights Plugin GitHub](https://github.com/inspektor-gadget/insights-plugin)
- [IG Desktop GitHub](https://github.com/inspektor-gadget/ig-desktop)
- [AKS Desktop Cluster Requirements](/docs/cluster-requirements.md)