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

function unexpected(): CliCommandError {
  return new CliCommandError('unexpected-result');
}

/** The data of an `info` result. */
async function infoResult(argv: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
  const { level, data } = await runCli(argv);
  if (level !== 'info') throw unexpected();
  return data;
}

export interface KubernetesVersionOption {
  /** The catalog `version` (`v1.36.1`), shown as is and passed to `--kubernetes-version`. */
  readonly version: string;
  readonly deprecated: boolean;
}

/**
 * One catalog entry, or null when it has no usable `version` or boolean `deprecated`. Other keys,
 * such as `k8sVersion` and `releaseNumber`, are ignored.
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

export interface CreateClusterInput {
  readonly name: string;
  /** The selected catalog entry's `version`. */
  readonly kubernetesVersion: string;
  /** NVIDIA GPU support. */
  readonly gpu: boolean;
}

/** A non-empty path the CLI reports; the plugin never opens it. */
function reportedPath(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

/**
 * `cluster create`: the CLI automatically merges the cluster's context, named after the
 * cluster, into the user's default kubeconfig and reports that file and the context. A conflicting
 * entry fails the command; the plugin never passes `--overwrite-kubeconfig`. A GPU create appends
 * `--enable-gpu`; the CLI picks the GPU vendor.
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
 * plugin's confirmation dialog asks first.
 */
export async function deleteCluster(name: string): Promise<void> {
  const argv = ['cluster', 'delete', ...OUTPUT, '--name', name, '--yes'];
  const { context, path } = await infoResult(argv);
  if (context !== name || !reportedPath(path)) throw unexpected();
}
