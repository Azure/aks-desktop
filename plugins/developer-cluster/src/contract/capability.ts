// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The Developer Cluster target and environment. AKS Desktop provides no local-cluster capability:
// the target is Developer Cluster's context among the contexts Headlamp loaded, and WSL comes from
// the plugin's own queries. A malformed local context throws LocalContextError.

import { isClusterName } from './clusterName';
import {
  isKubernetesDistribution,
  KubernetesDistribution,
  LOCAL_CONTEXT_MANAGED_BY,
} from './devctl';

/**
 * The WSL check's result: `ready` when `wsl --status` succeeds and WSL's default version is 2
 * (including when the `DefaultVersion` registry value is absent), `manual-setup-required` when
 * `wsl --status` fails or the default version is 1, and `unknown` when a query did not run or
 * finish, or its output could not be read.
 */
export type WslState = 'ready' | 'manual-setup-required' | 'unknown';
/**
 * The consent Setup asks for. The CLI always downloads the Ubuntu image and registers a new WSL 2
 * instance named after the cluster; it never uses a distribution the user installed.
 */
export type ConsentKind = 'install';

/** The Developer Cluster, read from its kubeconfig context. */
export interface LocalTarget {
  /** The cluster name the CLI recorded in `context_info.name`. */
  name: string;
  /** Null when the CLI did not record a recognized Kubernetes distribution. */
  distribution: KubernetesDistribution | null;
  /**
   * `context_info.kubernetesVersion`, supplied through `--kubernetes-version`.
   * Null when no version metadata is present; a credentials refresh may preserve earlier metadata.
   */
  kubernetesVersion: string | null;
  /**
   * `context_info.image`, the OS image the CLI created the cluster from (`Ubuntu-24.04`). Null
   * when no image metadata is present, as with earlier CLIs.
   */
  image: string | null;
  /** The kubeconfig context name Headlamp loaded it as. */
  contextName: string;
  /**
   * The name AKS Desktop lists the cluster under and its backend keys it by: the user's custom
   * display name when one is set, otherwise the context name.
   */
  listName: string;
}

/** The Developer Cluster target with the plugin's WSL check (src/native/platformChecks.ts). */
export interface HostEnvironment {
  /** The Developer Cluster whose context Headlamp loaded, or null when there is none. */
  target: LocalTarget | null;
  /** The result of the WSL 2 check. */
  wsl: WslState;
}

/** A malformed `/config` response or local context. */
export class LocalContextError extends Error {
  /**
   * Creates the error.
   *
   * @param message - The error message; a fixed default the UI never shows.
   */
  constructor(message = 'A local kubeconfig context has invalid metadata.') {
    super(message);
    this.name = 'LocalContextError';
  }
}

const CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._@:-]{0,252}$/;

/** Throws LocalContextError for a malformed response or local context; never returns. */
function fail(): never {
  throw new LocalContextError();
}

/**
 * Whether a value is an object with string keys: not null and not an array.
 *
 * @param value - The value to check.
 * @returns True for a non-null object that is not an array.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a valid kubeconfig context name: 1-253 characters of letters, digits and
 * `._@:-`, beginning with a letter or digit.
 *
 * @param value - The value to check.
 * @returns True for a valid context name.
 */
export function isContextName(value: unknown): value is string {
  return typeof value === 'string' && CONTEXT.test(value);
}

/**
 * The `context_info` of a Headlamp cluster entry (`meta_data.extensions`), or null.
 *
 * @param cluster - A Headlamp cluster entry.
 * @returns The `context_info` object, or null when the entry has none.
 */
function contextInfo(cluster: unknown): Record<string, unknown> | null {
  if (!isRecord(cluster) || !isRecord(cluster.meta_data)) return null;
  const { extensions } = cluster.meta_data;
  if (!isRecord(extensions) || !isRecord(extensions.context_info)) return null;
  return extensions.context_info;
}

/**
 * True for Developer Cluster's context: a context the CLI wrote, whose `context_info` records
 * `managedBy: aks-devctl`. Every driver and Kubernetes distribution counts; more than one such
 * context is the caller's `collision`.
 *
 * @param cluster - A Headlamp cluster entry.
 * @returns True when the entry's `context_info.managedBy` is `aks-devctl`.
 */
export function isLocalContext(cluster: unknown): boolean {
  return contextInfo(cluster)?.managedBy === LOCAL_CONTEXT_MANAGED_BY;
}

/**
 * The target a Headlamp cluster entry describes, or null when it is not Developer Cluster's context. The
 * context name is `meta_data.originalName`, because a custom display name replaces `name`; `name`
 * is the list name. A
 * local context without a valid cluster name or context name, or with a version or image that is
 * not a string, throws; a missing or empty version or image is unknown (null).
 *
 * @param cluster - A Headlamp cluster entry from `/config`.
 * @returns The decoded target, or null for another context.
 */
export function decodeLocalContext(cluster: unknown): LocalTarget | null {
  const info = contextInfo(cluster);
  if (info === null || !isLocalContext(cluster) || !isRecord(cluster)) return null;
  const metadata = cluster.meta_data as Record<string, unknown>;
  const contextName = metadata.originalName ?? cluster.name;
  if (!isClusterName(info.name) || !isContextName(contextName)) fail();
  const { kubernetesVersion = '', image = '' } = info;
  if (typeof kubernetesVersion !== 'string' || typeof image !== 'string') fail();
  return {
    name: info.name,
    distribution: isKubernetesDistribution(info.distribution) ? info.distribution : null,
    kubernetesVersion: kubernetesVersion || null,
    image: image || null,
    contextName,
    listName: typeof cluster.name === 'string' && cluster.name !== '' ? cluster.name : contextName,
  };
}

/**
 * Every Developer Cluster target in Headlamp's `/config` response (`{ clusters: [...] }`). Throws
 * LocalContextError for a malformed response or local context; more than one target is the
 * caller's to reject.
 *
 * @param config - Headlamp's `/config` response.
 * @returns The decoded targets, in response order; empty when no context is Developer Cluster's.
 */
export function decodeLocalTargets(config: unknown): LocalTarget[] {
  if (!isRecord(config) || !Array.isArray(config.clusters)) fail();
  return config.clusters
    .map(decodeLocalContext)
    .filter((target): target is LocalTarget => target !== null);
}

/**
 * Codes for states the plugin detects itself: `unsupported` from the environment step's platform
 * check, `already-exists` before Create, `identity-mismatch` before Delete and `collision` for more
 * than one local context. Their failure source stays `host`, a stable identifier. The UI maps each
 * code to fixed text.
 */
export type PluginErrorCode = 'unsupported' | 'already-exists' | 'identity-mismatch' | 'collision';
