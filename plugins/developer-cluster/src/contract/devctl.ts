// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The AKS Devctl CLI (`aks-devctl`) as this plugin release uses it: the command, the fixed local
// topology, the context it writes and its failure codes. Change this module, and the argv in
// src/cli/commands.ts, together with the pinned CLI version. The plugin checks neither the CLI
// version nor a protocol version.

/** The only executable the plugin runs through AKS Desktop. */
export const CLI_COMMAND = 'aks-devctl';

/** The fixed local topology: the CLI's Windows settings defaults, read-only in the UI. */
export const LOCAL_DISTRO = 'Ubuntu-24.04';
export const LOCAL_DISTRIBUTION = 'K8s';
export const LOCAL_NODE_COUNT = 1;

/**
 * The `context_info.managedBy` the CLI records on every context it writes
 * (`aks-devctl/src/pkg/edgecore/kubeconfig.go`, `tagBareMetalContexts`). It alone identifies
 * Developer Cluster's context among the contexts Headlamp loaded; Delete's kubeconfig pruning
 * requires it too, with further checks (`aks-devctl/src/cmd/credentials.go`).
 */
export const LOCAL_CONTEXT_MANAGED_BY = 'aks-devctl';

/**
 * The catalog entry's `version` from `cluster get-versions --output json` (`v1.36.1`), passed
 * unchanged to `--kubernetes-version`: the form the CLI documents
 * (`aks-devctl/src/pkg/edgecore/versions.go`, `CatalogVersion`). The CLI records it verbatim as
 * `context_info.kubernetesVersion`.
 */
export const K8S_VERSION_ARGUMENT = /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Fixed failure categories for one CLI invocation. The UI maps each code to a fixed localized
 * string; CLI text, stderr and event data are never displayed.
 */
export const CLI_ERROR_CODES = [
  /** The native bridge is missing, or Desktop could not start the process (negative exit). */
  'unavailable',
  /** Desktop refused to run the command: policy (exit -2) or declined consent (exit -3). */
  'denied',
  /** Non-zero or signal exit without an error event, or a negative exit after output. */
  'exit',
  /** Exit 0 without a result event. */
  'missing-terminal',
  /** A result event whose values the typed wrappers in src/cli/commands.ts reject. */
  'unexpected-result',
  /** The CLI reported an error event. */
  'failed',
] as const;

export type CliErrorCode = (typeof CLI_ERROR_CODES)[number];
