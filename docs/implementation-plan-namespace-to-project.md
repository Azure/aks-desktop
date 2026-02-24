# Implementation Plan: Turn Managed Namespace into Projects

**GitHub Issues**: [#151](https://github.com/Azure/aks-desktop/issues/151), [#162](https://github.com/Azure/aks-desktop/issues/162), [#163](https://github.com/Azure/aks-desktop/issues/163)

**Goal**: Allow users to convert existing AKS managed namespaces into Headlamp projects by applying project labels, optionally configuring networking/compute/access, and registering the cluster. Also support importing labeled namespaces not yet registered in this AKS Desktop instance.

---

## Table of Contents

1. [Background & Context](#1-background--context)
2. [Architecture Overview](#2-architecture-overview)
3. [Work Streams (Parallelizable)](#3-work-streams)
   - [Stream A: Shared Component Extraction](#stream-a-shared-component-extraction)
   - [Stream B: Namespace Discovery](#stream-b-namespace-discovery)
   - [Stream C: "From Namespace" Wizard UI](#stream-c-from-namespace-wizard-ui)
   - [Stream D: Label Application & Submission Logic](#stream-d-label-application--submission-logic)
   - [Stream E: Plugin Registration & Routing](#stream-e-plugin-registration--routing)
   - [Stream F: Documentation Link (Issue #162)](#stream-f-documentation-link-issue-162)
4. [Detailed File Changes](#4-detailed-file-changes)
5. [Testing Strategy](#5-testing-strategy)
6. [Implementation Order & Dependencies](#6-implementation-order--dependencies)

---

## 1. Background & Context

### How Projects Work Today

- A **project** in Headlamp is simply a Kubernetes namespace with the label `headlamp.dev/project-id`.
- An **AKS Desktop managed project** additionally has the label `headlamp.dev/project-managed-by: aks-desktop`.
- The `CreateAKSProject` wizard creates a **new** managed namespace via `az aks namespace add` with labels baked in.
- The `ImportAKSProjects` flow discovers namespaces that **already have** both project labels (created by AKS Desktop elsewhere) and registers their clusters locally.

### The Gap

There is no way to take an **existing** managed namespace (one that was created outside AKS Desktop, e.g., via Azure CLI or Portal) and turn it into a project. These namespaces exist but lack the `headlamp.dev/project-id` and `headlamp.dev/project-managed-by` labels.

### What This Plan Adds

A new "Create project from existing namespace" flow that:
1. Discovers all managed namespaces across the user's subscriptions via Azure Resource Graph
2. Shows **two categories**: (a) namespaces without project labels (need conversion), (b) namespaces with labels but not yet imported locally
3. Lets the user select a namespace, then walks through the existing wizard steps (Networking, Compute, Access, Review) to optionally update settings
4. Applies project labels via the Kubernetes API and registers the cluster locally

### Key Design Decisions

- **Entry point**: New option in the "New Project" popup (alongside "AKS managed project" and "Import AKS projects")
- **Scope**: Shows both non-project namespaces AND labeled-but-not-imported namespaces
- **Configuration depth**: Full wizard reuse — Networking, Compute, Access, and Review steps
- **Label application**: Via Headlamp's K8s API (`Namespace.apiEndpoint.put()`) since Azure CLI `az aks namespace update` doesn't support label changes
- **Code reuse**: Extract shared step components so both `CreateAKSProject` and the new flow use the same code

---

## 2. Architecture Overview

### New Component: `CreateProjectFromNamespace`

```
plugins/aks-desktop/src/
├── components/
│   ├── CreateAKSProject/
│   │   ├── CreateAKSProject.tsx          # Existing (modified: use shared steps)
│   │   ├── components/
│   │   │   ├── BasicsStep.tsx            # Existing (unchanged)
│   │   │   ├── NetworkingStep.tsx        # MOVE → shared/
│   │   │   ├── ComputeStep.tsx           # MOVE → shared/
│   │   │   ├── AccessStep.tsx            # MOVE → shared/
│   │   │   ├── ReviewStep.tsx            # Existing (unchanged, create-specific)
│   │   │   ├── Breadcrumb.tsx            # MOVE → shared/
│   │   │   ├── FormField.tsx             # MOVE → shared/
│   │   │   ├── SearchableSelect.tsx      # MOVE → shared/
│   │   │   ├── ValidationAlert.tsx       # MOVE → shared/
│   │   │   └── ResourceCard.tsx          # MOVE → shared/
│   │   ├── hooks/                        # Existing hooks (unchanged)
│   │   ├── types.ts                      # Existing (extended)
│   │   └── validators.ts                 # Existing (extended)
│   │
│   ├── CreateProjectFromNamespace/       # NEW
│   │   ├── CreateProjectFromNamespace.tsx # Main wizard component
│   │   ├── components/
│   │   │   ├── NamespaceSelectionStep.tsx # NEW: namespace picker
│   │   │   └── FromNamespaceReviewStep.tsx # NEW: review step (conversion-specific)
│   │   └── hooks/
│   │       └── useNamespaceDiscovery.ts  # NEW: Resource Graph discovery
│   │
│   └── shared/                           # NEW directory for shared components
│       └── ProjectWizardComponents.tsx   # Re-exports of shared step components
│           (OR individual files moved here — see Stream A)
```

### Flow Diagram

```
User clicks "New Project" → Popup shows 4 options:
  1. "New Project" (Headlamp built-in)
  2. "New Project from YAML" (Headlamp built-in)
  3. "AKS managed project" (existing)
  4. "Import AKS projects" (existing)
  5. "AKS project from namespace" ← NEW

User selects option 5 → Redirects to /projects/create-from-namespace

Step 1: Namespace Selection
  - Discovers managed namespaces via Resource Graph
  - Groups into: "Available for conversion" vs "Already labeled, import only"
  - User selects one namespace
  - Subscription/cluster/resourceGroup auto-populated from selection

Step 2: Networking Policies (shared NetworkingStep)
  - Pre-populated from existing namespace config if available

Step 3: Compute Quota (shared ComputeStep)
  - Pre-populated from existing namespace config if available

Step 4: Access (shared AccessStep)
  - Add user role assignments

Step 5: Review (custom FromNamespaceReviewStep)
  - Shows: namespace name, cluster, what labels will be applied, settings to update, users to add

Submit:
  - If namespace lacks project labels → Apply labels via K8s API
  - If networking/compute changed → Call updateManagedNamespace()
  - If users added → Call createNamespaceRoleAssignment() for each
  - Register cluster via registerAKSCluster()
  - Update localStorage allowed namespaces
  - Show success dialog
```

---

## 3. Work Streams

### Stream A: Shared Component Extraction

**Goal**: Move reusable step components and UI primitives to a shared location so both wizards can use them without duplication.

**Approach**: Create re-export barrel from a shared directory. The actual component files stay in `CreateAKSProject/components/` but are exported for reuse. Alternatively, physically move them to `components/shared/`. The simpler approach is re-exporting since it avoids large diffs.

> **Recommendation**: Use re-exports from a new `components/shared/ProjectWizardSteps.ts` file. This avoids moving files and changing all existing imports in `CreateAKSProject`.

#### Files to Create

**`plugins/aks-desktop/src/components/shared/ProjectWizardSteps.ts`**
```typescript
// Re-export shared wizard step components for reuse across project creation flows
export { NetworkingStep } from '../CreateAKSProject/components/NetworkingStep';
export { ComputeStep } from '../CreateAKSProject/components/ComputeStep';
export { AccessStep } from '../CreateAKSProject/components/AccessStep';
export { Breadcrumb } from '../CreateAKSProject/components/Breadcrumb';
export { FormField } from '../CreateAKSProject/components/FormField';
export { SearchableSelect } from '../CreateAKSProject/components/SearchableSelect';
export { ValidationAlert } from '../CreateAKSProject/components/ValidationAlert';
export { ResourceCard } from '../CreateAKSProject/components/ResourceCard';
```

> **Note on barrel files**: The project enforces `no-barrel-files` via ESLint. Instead of a barrel, each shared component should be imported directly from its source path. The new `CreateProjectFromNamespace` component should import directly:
> ```typescript
> import { NetworkingStep } from '../CreateAKSProject/components/NetworkingStep';
> import { ComputeStep } from '../CreateAKSProject/components/ComputeStep';
> import { AccessStep } from '../CreateAKSProject/components/AccessStep';
> ```

#### Shared Hooks

The following hooks from `CreateAKSProject/hooks/` can be reused directly by importing from their current paths:
- `useFormData` — manages FormData state
- `useValidation` — step validation
- `useAzureResources` — subscription/cluster fetching (needed if we want to show cluster info)
- `useExtensionCheck` — aks-preview extension check
- `useFeatureCheck` — ManagedNamespacePreview feature check

#### Shared Types

The types in `CreateAKSProject/types.ts` are already importable. The new flow will need some additional types (see Stream C), but the core `FormData`, `StepProps`, `ValidationState`, etc. are reusable as-is.

#### What Needs Modification for Sharing

The following components currently assume a "create new" context. Check if they need minor generalization:

1. **`NetworkingStep`** — Already generic. Takes `StepProps`. No changes needed.
2. **`ComputeStep`** — Already generic. Takes `StepProps`. No changes needed.
3. **`AccessStep`** — Already generic. Takes `StepProps`. No changes needed.
4. **`Breadcrumb`** — Already generic. Takes `BreadcrumbProps` (steps[], activeStep, onStepClick). No changes needed.
5. **`ReviewStep`** — **NOT shared**. It's specific to the create flow. The "from namespace" flow needs its own review step.
6. **`BasicsStep`** — **NOT shared**. The "from namespace" flow replaces this with `NamespaceSelectionStep`.
7. **`useValidation`** — May need extension to support the new step sequence (see Stream C).

---

### Stream B: Namespace Discovery

**Goal**: Create a hook that discovers all managed namespaces across the user's subscriptions, categorizing them as "needs conversion" or "already labeled / needs import".

#### New File: `plugins/aks-desktop/src/components/CreateProjectFromNamespace/hooks/useNamespaceDiscovery.ts`

**Resource Graph Query Strategy**:

Query ALL managed namespaces (not just labeled ones), then categorize client-side:

```typescript
// Query: Get all managed namespaces across all subscriptions
const query = `resources
  | where type =~ 'microsoft.containerservice/managedclusters/managednamespaces'
  | project
      id,
      name,
      resourceGroup,
      subscriptionId,
      clusterName = tostring(split(id, '/')[8]),
      labels = properties['labels'],
      provisioningState = properties['provisioningState'],
      cpuRequest = properties['resourceQuota']['cpuRequest'],
      cpuLimit = properties['resourceQuota']['cpuLimit'],
      memoryRequest = properties['resourceQuota']['memoryRequest'],
      memoryLimit = properties['resourceQuota']['memoryLimit'],
      ingressPolicy = properties['networkPolicy']['ingressPolicy'],
      egressPolicy = properties['networkPolicy']['egressPolicy']`;
```

> **Important**: The exact property paths for resourceQuota and networkPolicy in Resource Graph need to be verified at implementation time. The Azure Resource Graph schema for `microsoft.containerservice/managedclusters/managednamespaces` may use different property names. Use `az graph query` manually to check the schema first. If quota/policy fields are not available from Resource Graph, fall back to `getManagedNamespaceDetails()` per-namespace after selection.

**Categorization Logic**:

```typescript
interface DiscoveredNamespace {
  name: string;
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
  labels: Record<string, string> | null;
  provisioningState: string;
  // Existing config (if available from Resource Graph)
  existingConfig?: {
    cpuRequest?: number;
    cpuLimit?: number;
    memoryRequest?: number;
    memoryLimit?: number;
    ingressPolicy?: string;
    egressPolicy?: string;
  };
}

type NamespaceCategory = 'needs-conversion' | 'needs-import';

function categorizeNamespace(ns: DiscoveredNamespace): NamespaceCategory {
  const hasProjectId = ns.labels?.['headlamp.dev/project-id'];
  const hasManagedBy = ns.labels?.['headlamp.dev/project-managed-by'] === 'aks-desktop';

  if (hasProjectId && hasManagedBy) {
    // Has labels but might not be imported locally
    return 'needs-import';
  }
  // No project labels — needs conversion
  return 'needs-conversion';
}
```

**Filtering Out Already-Imported Namespaces**:

Check localStorage `cluster_settings.{clusterName}.allowedNamespaces` to determine if a namespace is already imported. Also check `useClustersConf()` to see if the cluster is registered.

**Hook Interface**:

```typescript
interface UseNamespaceDiscoveryReturn {
  namespaces: DiscoveredNamespace[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // Computed categories
  needsConversion: DiscoveredNamespace[];
  needsImport: DiscoveredNamespace[];
}

function useNamespaceDiscovery(): UseNamespaceDiscoveryReturn;
```

**Implementation Notes**:
- Use `runCommandAsync('az', ['graph', 'query', '-q', query, '--output', 'json'])` (same pattern as ImportAKSProjects)
- Handle Windows quoting: wrap query in `"..."` on `win32` platform
- Extract cluster name from resource ID using regex: `/managedClusters\/([^\/]+)/`
- Filter out system namespaces (kube-system, kube-public, default, gatekeeper-system) if they appear
- Filter out namespaces where `provisioningState !== 'Succeeded'`

---

### Stream C: "From Namespace" Wizard UI

**Goal**: Build the main wizard component that ties together namespace selection and the shared configuration steps.

#### New File: `plugins/aks-desktop/src/components/CreateProjectFromNamespace/CreateProjectFromNamespace.tsx`

**Step Sequence**:

```typescript
const STEPS_FROM_NAMESPACE = [
  'Select Namespace',     // Step 0 — NEW
  'Networking Policies',  // Step 1 — shared
  'Compute Quota',        // Step 2 — shared
  'Access',               // Step 3 — shared
  'Review',               // Step 4 — NEW (conversion-specific)
] as const;
```

**Component Structure** (mirrors `CreateAKSProject.tsx`):

```typescript
function CreateProjectFromNamespace() {
  // --- State ---
  const [activeStep, setActiveStep] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState('');
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [applicationName, setApplicationName] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<DiscoveredNamespace | null>(null);

  // --- Shared hooks ---
  const { formData, updateFormData } = useFormData();
  const namespaceDiscovery = useNamespaceDiscovery();
  const extensionStatus = useExtensionCheck();

  // --- When namespace is selected, populate formData ---
  useEffect(() => {
    if (selectedNamespace) {
      updateFormData({
        projectName: selectedNamespace.name, // Namespace name becomes project name
        subscription: selectedNamespace.subscriptionId,
        cluster: selectedNamespace.clusterName,
        resourceGroup: selectedNamespace.resourceGroup,
        // Pre-populate from existing config if available
        ...(selectedNamespace.existingConfig?.cpuRequest && {
          cpuRequest: selectedNamespace.existingConfig.cpuRequest,
        }),
        // ... etc for other fields
      });
    }
  }, [selectedNamespace]);

  // --- Validation ---
  // Reuse validators but skip project-name-uniqueness check
  // (namespace already exists, that's the point)

  // --- Step rendering ---
  const renderStepContent = (step: number) => {
    switch (step) {
      case 0: return <NamespaceSelectionStep ... />;
      case 1: return <NetworkingStep ... />;  // shared
      case 2: return <ComputeStep ... />;     // shared
      case 3: return <AccessStep ... />;      // shared
      case 4: return <FromNamespaceReviewStep ... />;
    }
  };

  // --- Layout: same Card/Breadcrumb/Footer pattern as CreateAKSProject ---
  // --- Loading/Success/Error overlays: same pattern as CreateAKSProject ---
}
```

**Key Differences from `CreateAKSProject`**:
1. Step 0 is `NamespaceSelectionStep` instead of `BasicsStep`
2. `projectName` is derived from the selected namespace name (not user-entered)
3. No need for `useNamespaceCheck` (we *want* the namespace to exist)
4. No `createManagedNamespace` call — namespace already exists
5. Review step shows "will apply labels" instead of "will create namespace"
6. Submission logic applies labels + optionally updates config + assigns roles

#### New File: `plugins/aks-desktop/src/components/CreateProjectFromNamespace/components/NamespaceSelectionStep.tsx`

**UI Design**:

```
┌──────────────────────────────────────────────────────────────┐
│ Select a Namespace                                           │
│                                                              │
│ [Extension/Feature warnings if applicable]                   │
│                                                              │
│ ┌─ Available for Conversion ──────────────────────────────┐  │
│ │  Managed namespaces that are not yet projects           │  │
│ │                                                          │  │
│ │  ○ my-namespace-1    my-cluster-1    eastus    rg-1     │  │
│ │  ○ my-namespace-2    my-cluster-2    westus    rg-2     │  │
│ └──────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌─ Available for Import ──────────────────────────────────┐  │
│ │  Already labeled as projects but not imported locally    │  │
│ │                                                          │  │
│ │  ○ labeled-ns-1      my-cluster-3    centralus  rg-3   │  │
│ └──────────────────────────────────────────────────────────┘  │
│                                                              │
│ [No namespaces found? Check that you have managed           │
│  namespaces in your Azure subscriptions.]                    │
└──────────────────────────────────────────────────────────────┘
```

**Props**:

```typescript
interface NamespaceSelectionStepProps {
  namespaces: DiscoveredNamespace[];
  needsConversion: DiscoveredNamespace[];
  needsImport: DiscoveredNamespace[];
  loading: boolean;
  error: string | null;
  selectedNamespace: DiscoveredNamespace | null;
  onSelectNamespace: (ns: DiscoveredNamespace) => void;
  extensionStatus: ExtensionStatus;
  onInstallExtension: () => Promise<void>;
  onRefresh: () => Promise<void>;
}
```

**Implementation Notes**:
- Use radio buttons (single selection) — user picks one namespace at a time
- Show namespace name, cluster name, location, resource group in each row
- Use the Headlamp `Table` component (same as ImportAKSProjects) for consistency
- Group by category with section headers
- Show loading spinner while discovery is in progress
- Show warning banners for extension/feature checks (reuse `ValidationAlert`)
- Add a "Refresh" button to re-run discovery
- Validation: step is valid only when a namespace is selected AND extension/feature checks pass

#### New File: `plugins/aks-desktop/src/components/CreateProjectFromNamespace/components/FromNamespaceReviewStep.tsx`

**Content**: Similar to existing `ReviewStep` but adapted for conversion:
- Show: "Namespace: {name}" (not "Project Name")
- Show: "Cluster: {cluster}" and "Resource Group: {rg}"
- Show: "Labels to apply" section listing the 4 project labels
- Show: Networking policies (current → new, if changed)
- Show: Compute quotas (current → new, if changed)
- Show: Users to be assigned
- For "needs-import" namespaces, note that labels already exist

**Props**: Same as `ReviewStepProps` plus `selectedNamespace: DiscoveredNamespace` and `isImportOnly: boolean`.

---

### Stream D: Label Application & Submission Logic

**Goal**: Implement the submission handler that applies labels, updates configuration, and assigns roles.

This lives in `CreateProjectFromNamespace.tsx` as `handleSubmit()`.

#### Submission Flow

```typescript
const handleSubmit = async () => {
  setIsConverting(true);
  setConversionError(null);

  try {
    // STEP 1: Apply project labels (if namespace needs conversion)
    if (selectedNamespace.category === 'needs-conversion') {
      setConversionProgress('Applying project labels...');

      // Fetch current namespace object via K8s API
      const nsData = await fetchNamespaceData(
        selectedNamespace.name,
        selectedNamespace.clusterName
      );

      // Add project labels
      const updatedData = { ...nsData };
      updatedData.metadata.labels = {
        ...updatedData.metadata.labels,
        'headlamp.dev/project-id': selectedNamespace.name,
        'headlamp.dev/project-managed-by': 'aks-desktop',
        'aks-desktop/project-subscription': selectedNamespace.subscriptionId,
        'aks-desktop/project-resource-group': selectedNamespace.resourceGroup,
      };

      // Apply via K8s API
      await K8s.ResourceClasses.Namespace.apiEndpoint.put(
        updatedData,
        {},
        selectedNamespace.clusterName
      );
    }

    // STEP 2: Update networking/compute if changed
    const configChanged = hasConfigChanged(selectedNamespace.existingConfig, formData);
    if (configChanged) {
      setConversionProgress('Updating namespace configuration...');
      await updateManagedNamespace({
        clusterName: selectedNamespace.clusterName,
        resourceGroup: selectedNamespace.resourceGroup,
        namespaceName: selectedNamespace.name,
        subscriptionId: selectedNamespace.subscriptionId,
        cpuRequest: formData.cpuRequest,
        cpuLimit: formData.cpuLimit,
        memoryRequest: formData.memoryRequest,
        memoryLimit: formData.memoryLimit,
        ingressPolicy: formData.ingress,
        egressPolicy: formData.egress,
      });
    }

    // STEP 3: Register cluster locally (same as Import flow)
    setConversionProgress('Registering cluster...');
    await registerAKSCluster(
      selectedNamespace.subscriptionId,
      selectedNamespace.resourceGroup,
      selectedNamespace.clusterName,
      selectedNamespace.name  // namespace-scoped credentials
    );

    // STEP 4: Update allowed namespaces in localStorage
    const settings = JSON.parse(
      localStorage.getItem(`cluster_settings.${selectedNamespace.clusterName}`) || '{}'
    );
    settings.allowedNamespaces ??= [];
    if (!settings.allowedNamespaces.includes(selectedNamespace.name)) {
      settings.allowedNamespaces.push(selectedNamespace.name);
    }
    localStorage.setItem(
      `cluster_settings.${selectedNamespace.clusterName}`,
      JSON.stringify(settings)
    );

    // STEP 5: Add users (same logic as CreateAKSProject)
    // ... (reuse the role assignment loop from CreateAKSProject)

    // STEP 6: Show success
    setShowSuccessDialog(true);
  } catch (error) {
    setConversionError(error.message);
  } finally {
    setIsConverting(false);
  }
};
```

#### Helper: Fetch Namespace via K8s API

```typescript
function fetchNamespaceData(name: string, cluster: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const cancelFn = K8s.ResourceClasses.Namespace.apiEndpoint.get(
      name,
      (ns: any) => {
        resolve(ns.jsonData ?? ns);
        cancelFn.then(cancel => cancel());
      },
      (err: any) => {
        reject(new Error(`Failed to fetch namespace: ${err}`));
      },
      {},
      cluster
    );
  });
}
```

**This helper should be placed in a shared utility**, e.g., `plugins/aks-desktop/src/utils/kubernetes/namespaceUtils.ts`, since it's useful for both the conversion flow and potentially other features.

#### Shared Role Assignment Logic

The role assignment loop in `CreateAKSProject.handleSubmit()` (lines 291-415) should be extracted into a shared function:

**New File**: `plugins/aks-desktop/src/utils/azure/roleAssignment.ts`

```typescript
interface AssignRolesOptions {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId: string;
  assignments: UserAssignment[];
  onProgress?: (message: string) => void;
}

interface AssignRolesResult {
  success: boolean;
  results: string[];
  errors: string[];
}

export async function assignRolesToNamespace(options: AssignRolesOptions): Promise<AssignRolesResult>;
```

This extracts the entire for-loop that:
1. Maps UI role → Azure role
2. Creates 3 role assignments per user
3. Verifies access
4. Collects results and errors

Both `CreateAKSProject.handleSubmit()` and the new `handleSubmit()` call this shared function.

---

### Stream E: Plugin Registration & Routing

**Goal**: Register the new flow as a custom create project option and route.

#### Changes to `plugins/aks-desktop/src/index.tsx`

Add (after existing registrations):

```typescript
import CreateProjectFromNamespace from './components/CreateProjectFromNamespace/CreateProjectFromNamespace';

// Route
registerRoute({
  path: '/projects/create-from-namespace',
  component: CreateProjectFromNamespace,
  name: 'Create Project from Namespace',
  exact: true,
  noAuthRequired: true,
  useClusterURL: false,
});

// Custom create project option
registerCustomCreateProject({
  id: 'aks-from-namespace',
  name: 'AKS project from existing namespace',
  description: 'Convert an existing AKS managed namespace into a project',
  component: () => <Redirect to="/projects/create-from-namespace" />,
  icon: 'mdi:folder-swap-outline',
});
```

This adds a third AKS option to the "New Project" popup in Headlamp.

---

### Stream F: Documentation Link (Issue #162)

**Goal**: Add a link to the AKS managed namespaces documentation in the README.

#### Changes to `README.md`

Add a section (or add to an existing section) with a link to the documentation:

```markdown
## Documentation

- [AKS Managed Namespaces](https://learn.microsoft.com/en-us/azure/aks/manage-namespaces)
```

> **Note**: The exact URL may not exist yet. Use a placeholder URL pointing to the Azure AKS docs. When the official documentation is published, update the link. Per issue #162: "the documentation does not exist for this yet. But adding a link to our documentation can be enough to start with."

---

## 4. Detailed File Changes

### New Files

| File | Stream | Description |
|------|--------|-------------|
| `components/CreateProjectFromNamespace/CreateProjectFromNamespace.tsx` | C | Main wizard component |
| `components/CreateProjectFromNamespace/components/NamespaceSelectionStep.tsx` | C | Step 0: namespace picker |
| `components/CreateProjectFromNamespace/components/FromNamespaceReviewStep.tsx` | C | Step 4: review for conversion |
| `components/CreateProjectFromNamespace/hooks/useNamespaceDiscovery.ts` | B | Resource Graph discovery hook |
| `utils/azure/roleAssignment.ts` | D | Shared role assignment logic |
| `utils/kubernetes/namespaceUtils.ts` | D | Shared K8s namespace helpers |

### Modified Files

| File | Stream | Changes |
|------|--------|---------|
| `index.tsx` | E | Add route + registerCustomCreateProject for new flow |
| `components/CreateAKSProject/CreateAKSProject.tsx` | A, D | Refactor handleSubmit to use shared `assignRolesToNamespace()` |
| `components/CreateAKSProject/types.ts` | A | Export any types needed by new flow (already exported, may need minor additions) |
| `README.md` | F | Add documentation link |

### Files That Stay Unchanged

These are already properly structured for reuse:
- `components/CreateAKSProject/components/NetworkingStep.tsx`
- `components/CreateAKSProject/components/ComputeStep.tsx`
- `components/CreateAKSProject/components/AccessStep.tsx`
- `components/CreateAKSProject/components/Breadcrumb.tsx`
- `components/CreateAKSProject/components/FormField.tsx`
- `components/CreateAKSProject/components/SearchableSelect.tsx`
- `components/CreateAKSProject/components/ValidationAlert.tsx`
- `components/CreateAKSProject/components/ResourceCard.tsx`
- `components/CreateAKSProject/hooks/useFormData.ts`
- `components/CreateAKSProject/hooks/useAzureResources.ts`
- `components/CreateAKSProject/hooks/useExtensionCheck.ts`
- `components/CreateAKSProject/hooks/useFeatureCheck.ts`
- `components/CreateAKSProject/validators.ts`
- `utils/azure/az-cli.ts` (all needed functions already exist)
- `utils/azure/aks.ts` (registerAKSCluster already exists)

---

## 5. Testing Strategy

### Unit Tests

Each new file should have a corresponding test file:

| Test File | Tests |
|-----------|-------|
| `useNamespaceDiscovery.test.ts` | Mock `runCommandAsync`, test categorization logic, test filtering of imported namespaces, test error handling |
| `NamespaceSelectionStep.test.tsx` | Render with namespaces, test radio selection, test empty state, test loading state |
| `FromNamespaceReviewStep.test.tsx` | Render with conversion data, render with import data, verify labels shown |
| `CreateProjectFromNamespace.test.tsx` | Full wizard navigation, mock submission, test success/error states |
| `roleAssignment.test.ts` | Mock createNamespaceRoleAssignment, test multi-role assignment, test partial failure handling |
| `namespaceUtils.test.ts` | Mock K8s API, test label application, test fetch failure |

### Integration Considerations

- The Resource Graph query requires Azure authentication — tests should mock `runCommandAsync`
- Label application via K8s API requires a connected cluster — tests should mock `K8s.ResourceClasses.Namespace.apiEndpoint`
- Test that `CreateAKSProject` still works after refactoring `handleSubmit` to use shared `assignRolesToNamespace`

---

## 6. Implementation Order & Dependencies

### Dependency Graph

```
Stream F (README docs link)          ← Independent, do first or anytime
Stream A (Shared component extraction) ← Independent
Stream B (Namespace discovery hook)    ← Independent

Stream D (Submission logic)            ← Depends on: Stream A (types)
Stream C (Wizard UI)                   ← Depends on: Stream A, Stream B, Stream D
Stream E (Registration & routing)      ← Depends on: Stream C
```

### Recommended Parallel Execution Plan

**Phase 1** (Parallel — no dependencies):
- Stream A: Extract shared components / verify reusability
- Stream B: Build `useNamespaceDiscovery` hook
- Stream F: Add README docs link
- Stream D (partial): Build `assignRolesToNamespace` and `namespaceUtils`

**Phase 2** (Parallel — depends on Phase 1):
- Stream C: Build wizard UI (`CreateProjectFromNamespace`, `NamespaceSelectionStep`, `FromNamespaceReviewStep`)
- Stream D (complete): Wire up `handleSubmit` in new wizard + refactor `CreateAKSProject` to use shared role assignment

**Phase 3** (Sequential — depends on Phase 2):
- Stream E: Add plugin registration and routing
- Final integration testing

### Commit Strategy

Suggested atomic commits:
1. `Extract shared role assignment utility from CreateAKSProject`
2. `Add namespace K8s utility helpers`
3. `Add namespace discovery hook with Resource Graph query`
4. `Add NamespaceSelectionStep component`
5. `Add FromNamespaceReviewStep component`
6. `Add CreateProjectFromNamespace wizard component`
7. `Register create-from-namespace route and project option`
8. `Add documentation link to README`
9. `Add tests for namespace-to-project flow`

---

## Appendix A: Key Labels Reference

| Label | Value | Purpose |
|-------|-------|---------|
| `headlamp.dev/project-id` | namespace name | Identifies namespace as a Headlamp project |
| `headlamp.dev/project-managed-by` | `aks-desktop` | Marks as AKS Desktop managed |
| `aks-desktop/project-subscription` | subscription ID | Tracks owning subscription |
| `aks-desktop/project-resource-group` | resource group name | Tracks resource group |

## Appendix B: Key Existing Functions Reference

| Function | File | Purpose |
|----------|------|---------|
| `createManagedNamespace()` | `az-cli.ts:2076` | Creates new namespace (NOT used in this flow) |
| `updateManagedNamespace()` | `az-cli.ts:1416` | Updates quota/network policies on existing namespace |
| `checkNamespaceExists()` | `az-cli.ts:1818` | Checks if namespace exists in cluster |
| `getManagedNamespaceDetails()` | `az-cli.ts:1358` | Gets full namespace details including labels |
| `createNamespaceRoleAssignment()` | `az-cli.ts:2301` | Assigns Azure RBAC role to user on namespace |
| `verifyNamespaceAccess()` | `az-cli.ts:2449` | Verifies user has expected access |
| `registerAKSCluster()` | `aks.ts:91` | Registers cluster in Headlamp via Electron IPC |
| `runCommandAsync()` | `az-cli.ts` | Executes shell commands (used for Resource Graph) |
| `isAksProject()` | `isAksProject.tsx` | Checks if namespace has AKS Desktop labels |

## Appendix C: ESLint Constraints

- **No barrel files**: Do NOT create `index.ts` re-export files. Import each component from its direct path.
- **Headlamp ESLint config**: Follow `@headlamp-k8s` ESLint rules.
- **Prettier**: Run `npm run format` before committing.

## Appendix D: Validation Considerations for "From Namespace" Flow

The existing `useValidation` hook calls `validateStep()` based on step index. For the new flow, a new validation function or adapter is needed since the step mapping is different:

| Step | CreateAKSProject | CreateProjectFromNamespace |
|------|------------------|----------------------------|
| 0 | BasicsStep validation (name, subscription, cluster, extension, feature) | NamespaceSelectionStep validation (namespace selected, extension check) |
| 1 | NetworkingStep validation | NetworkingStep validation (same) |
| 2 | ComputeStep validation | ComputeStep validation (same) |
| 3 | AccessStep validation | AccessStep validation (same) |
| 4 | ReviewStep validation (all valid) | FromNamespaceReviewStep validation (all valid) |

**Approach**: Create a `useFromNamespaceValidation` hook that reuses the individual validators (`validateNetworkingPolicies`, `validateComputeQuota`, `validateAssignments`) but replaces step 0 validation with namespace-selection validation.
