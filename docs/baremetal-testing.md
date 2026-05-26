# Testing with AKS BareMetal Clusters

This document describes how to set up, test, and tear down an AKS BareMetal
(hybrid/edge) cluster environment for local development of AKS Desktop.

## Prerequisites

- Azure CLI installed (`az`) — bundled with AKS Desktop
- An Azure subscription with quota for **Standard\_E16s\_v5** VMs
  (16 vCPUs, 128 GiB RAM)
- Contributor access to the target subscription

## Quick Start

### 1. Set up the environment

From the repository root:

```bash
npm run setupBareMetalEnv -- \
  --subscription <subscription-id> \
  --location westus2 \
  --username azureuser \
  --password 'YourSecurePassword123!'
```

Optional flags:

| Flag | Default | Description |
| --- | --- | --- |
| `--group-name` | `jumpstart-rg` | Resource group name |
| `--vm-name` | `jumpstartVM` | Virtual machine name |
| `--vm-size` | `Standard_E16s_v5` | VM size (SKU) |
| `--vnet-name` | `jumpstartVNet` | Virtual network name |
| `--subnet-name` | `jumpstartSubnet` | Subnet name |

This creates a Windows Server 2022 VM (with a 1 TiB data disk for working
storage) and runs 5 upstream aksArc jumpstart init scripts on the VM via
`az deployment group create`. The last script installs MOC and triggers a
VM restart. The setup command auto-opens an RDP file once the VM is ready —
wait for Server Manager to appear, then disconnect. MOC finishes installing
in the background (~3–5 min after boot).

### 2. Deploy AKS BareMetal components

After the VM is created (with MOC pre-installed), deploy AKS Arc components:

```bash
npm run deployAksArc -- \
  --subscription <subscription-id> \
  --group-name jumpstart-rg
```

This runs 7 deployment scripts sequentially via `az deployment group create`.

### 3. Register the cluster in AKS Desktop

1. Open AKS Desktop and go to **Add Cluster → Azure Kubernetes Service**.
2. Select your subscription — BareMetal clusters appear alongside standard AKS
   clusters, labelled **AKSARC**.
3. Select the BareMetal cluster and click **Register**.
4. Use the proxy controls (Start / Stop / Restart / Refresh) to manage
   the `az connectedk8s proxy` connection.

### 4. Tear down the environment

```bash
npm run teardownBareMetalEnv -- \
  --subscription <subscription-id> \
  --group-name jumpstart-rg
```

This deletes the resource group and all associated resources.

## UI-based Setup / Teardown

If the **BareMetal Test Environment** preview feature is enabled in
**Settings → Preview Features**, AKS Desktop shows an additional
cluster provider in the **Add Cluster** page that exposes the same
setup and teardown operations through a dialog.

## Enabling / Disabling the Feature

The BareMetal environment UI is gated by a preview feature flag. To toggle it:

1. Open AKS Desktop → **Settings** → **Preview Features**.
2. Toggle **BareMetal Test Environment** on or off.

When disabled, the cluster provider and route are not registered and the
UI is completely hidden.

## Architecture

| Layer | File | Purpose |
| --- | --- | --- |
| Utility | `plugins/aks-desktop/src/components/BareMetal/environment.ts` | Setup / teardown / provider registration logic |
| Proxy | `plugins/aks-desktop/src/components/BareMetal/proxy.ts` | BareMetal proxy lifecycle management |
| Hook | `plugins/aks-desktop/src/components/BareMetal/useBareMetalExtensionCheck.ts` | Check & install `connectedk8s` + `aksarc` CLI extensions |
| Hook | `plugins/aks-desktop/src/components/BareMetal/useBareMetalProxy.ts` | BareMetal proxy status polling & action dispatch |
| Dialog | `plugins/aks-desktop/src/components/BareMetal/BareMetalEnvironmentDialog.tsx` | Stateful dialog component |
| Pure UI | `plugins/aks-desktop/src/components/BareMetal/BareMetalEnvironmentDialogPure.tsx` | Presentational dialog |
| Page | `plugins/aks-desktop/src/components/BareMetal/BareMetalEnvironmentPage.tsx` | Route target wrapping the dialog |
| Feature flag | `plugins/aks-desktop/src/components/PluginSettings/previewFeaturesStore.ts` | `bareMetalEnvironment` toggle |
| CLI script | `scripts/baremetal-env.ts` | Node CLI that mirrors the UI logic for `npm run setupBareMetalEnv` / `teardownBareMetalEnv` |

## Troubleshooting

### VM quota errors

Ensure your subscription has quota for E16s\_v5 VMs in the target region.
You can request a quota increase in the Azure portal under
**Subscriptions → Usage + quotas**.

### Provider registration failures

The setup registers seven Azure resource providers. If one fails, check
that you have Contributor or Owner access on the subscription.

### Extensions not found

AKS Desktop will prompt you to install the `connectedk8s` and `aksarc`
CLI extensions when they are missing. Click **Install Extensions** in the
dialog to install them automatically.

### Proxy won't start

Make sure you have registered the cluster and that `az connectedk8s proxy`
can reach the cluster. Common causes: expired credentials, port conflicts,
or the BareMetal agent not running on the VM.
