// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Typed wrappers for the three granted `aks-devctl` commands. Each wrapper builds its argv, runs it
// and checks the values it reads from the result event. An impossible value is `unexpected-result`;
// other result keys are ignored. Only the fields the workflow needs are returned, and no CLI text
// is.
//
// AKS Desktop grants these argv shapes exactly, so keep them in step with its grants. Every command
// sits under `cluster` and asks for JSON Lines; the provider and the WSL image are CLI settings,
// not flags, and the CLI names the WSL instance after the cluster. Callers pass only checked
// values: a valid cluster name and a catalog version.

import { isRecord } from '../contract/capability';
import { K8S_VERSION_ARGUMENT, LOCAL_DISTRIBUTION } from '../contract/devctl';
import { CliCommandError, runCli } from './runner';

/** JSON Lines events on stdout. */
const OUTPUT = ['--output', 'json'];

/**
 * The error for a result event whose values a wrapper rejects.
 *
 * @returns A new CliCommandError with the code `unexpected-result`.
 */
function unexpected(): CliCommandError {
  return new CliCommandError('unexpected-result');
}

/**
 * The data of an `info` result: runs `aks-devctl` with `argv` and checks the result's level.
 *
 * @param argv - Arguments after `aks-devctl`, built by a typed wrapper.
 * @returns A promise of the result event's data. It rejects with `unexpected-result` for a `warn`
 * result, and with the runner's CliCommandError when the command fails.
 */
async function infoResult(argv: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
  const { level, data } = await runCli(argv);
  if (level !== 'info') throw unexpected();
  return data;
}

/** One entry of the CLI's Kubernetes catalog (`cluster get-versions`). */
export interface KubernetesVersionOption {
  /** The catalog `version` (`v1.36.1`), shown as is and passed to `--kubernetes-version`. */
  readonly version: string;
  /** The catalog marks the version deprecated; Setup does not let the user select it. */
  readonly deprecated: boolean;
}

/**
 * One catalog entry, or null when it has no usable `version` or boolean `deprecated`. Other keys,
 * such as `k8sVersion` and `releaseNumber`, are ignored.
 *
 * @param value - One element of the `versions` array in the result data.
 * @returns A frozen entry with `version` and `deprecated`, or null for an unusable element.
 */
function catalogEntry(value: unknown): KubernetesVersionOption | null {
  if (!isRecord(value)) return null;
  const { version, deprecated } = value;
  if (typeof version !== 'string' || !K8S_VERSION_ARGUMENT.test(version)) return null;
  if (typeof deprecated !== 'boolean') return null;
  return Object.freeze({ version, deprecated });
}

/**
 * The CLI's Kubernetes catalog in CLI order, newest first. Invalid entries and repeats of a version
 * are skipped; only a list with no usable entry is `unexpected-result`.
 *
 * @returns A promise of the frozen catalog entries. It rejects with `unexpected-result` when the
 * result has no `versions` array or no usable entry, and with the runner's CliCommandError when the
 * command fails.
 */
export async function listKubernetesVersions(): Promise<readonly KubernetesVersionOption[]> {
  const { versions } = await infoResult(['cluster', 'get-versions', ...OUTPUT]);
  if (!Array.isArray(versions)) throw unexpected();
  const entries: KubernetesVersionOption[] = [];
  for (const value of versions) {
    const entry = catalogEntry(value);
    if (entry !== null && !entries.some(known => known.version === entry.version)) {
      entries.push(entry);
    }
  }
  if (entries.length === 0) throw unexpected();
  return Object.freeze(entries);
}

/** The checked inputs of `cluster create`. */
export interface CreateClusterInput {
  /** The cluster name, passed to `--name`; the CLI names the context after it. */
  readonly name: string;
  /** The selected catalog entry's `version`. */
  readonly kubernetesVersion: string;
  /** NVIDIA GPU support. */
  readonly gpu: boolean;
}

/**
 * A non-empty path the CLI reports; the plugin never opens it.
 *
 * @param value - The `path` value of a result event.
 * @returns True for a non-empty string.
 */
function reportedPath(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

/**
 * `cluster create`: the CLI automatically merges the cluster's context, named after the
 * cluster, into the user's default kubeconfig and reports that file and the context. A conflicting
 * entry fails the command; the plugin never passes `--overwrite-kubeconfig`. A GPU create appends
 * `--enable-gpu`; the CLI picks the GPU vendor. Rejects with `unexpected-result` when the result
 * names another context or no path, and with the runner's CliCommandError when the command fails.
 *
 * @param input - The cluster name, catalog version and GPU choice, already validated.
 */
export async function createCluster(input: CreateClusterInput): Promise<void> {
  const { name, kubernetesVersion, gpu } = input;
  const argv = [
    'cluster',
    'create',
    ...OUTPUT,
    '--kubernetes-distribution',
    LOCAL_DISTRIBUTION,
    '--name',
    name,
    '--kubernetes-version',
    kubernetesVersion,
    ...(gpu === true ? ['--enable-gpu'] : []),
  ];
  const { context, path } = await infoResult(argv);
  if (context !== name || !reportedPath(path)) throw unexpected();
}

/**
 * `cluster delete --yes`: the CLI removes the cluster's WSL instance and everything in
 * it, then the cluster's entries in the user's default kubeconfig, and reports that file and the
 * context. A cleanup failure fails the command. `--yes` replaces the CLI's interactive prompt; the
 * plugin's confirmation dialog asks first. Rejects like createCluster.
 *
 * @param name - The name of the cluster to delete, which its context is named after.
 */
export async function deleteCluster(name: string): Promise<void> {
  const argv = ['cluster', 'delete', ...OUTPUT, '--name', name, '--yes'];
  const { context, path } = await infoResult(argv);
  if (context !== name || !reportedPath(path)) throw unexpected();
}
